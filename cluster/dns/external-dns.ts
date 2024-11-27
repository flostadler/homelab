import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

export interface ExternalDnsConfig {
    version: pulumi.Input<string>,
    cloudflareAccountId: pulumi.Input<string>,
    clusterName: pulumi.Input<string>,
    parentDomains: pulumi.Input<pulumi.Input<string>[]>,
}

export class ExternalDns extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly chart: k8s.helm.v3.Release;

    constructor(name: string, config: ExternalDnsConfig, opts?: pulumi.ComponentResourceOptions) {
        super("cluster:dns:ExternalDns", name, config, opts);

        this.namespace = new k8s.core.v1.Namespace(name, {
            metadata: {
                name: name,
            },
        }, { parent: this });
    
        const permissions = cloudflare.getApiTokenPermissionGroupsOutput({ parent: this });
        
        const hotstedZoneIds = pulumi.output(config.parentDomains).apply(parentDomains => {
            return parentDomains.map(parentDomain => {
                return cloudflare.getZoneOutput({
                    name: parentDomain,
                    accountId: config.cloudflareAccountId,
                }, { parent: this });
            });
        });
        
        // create a token that's allowed to manage the parent domains
        const cfToken = new cloudflare.ApiToken(name, {
            name: pulumi.interpolate`${config.clusterName}-${name}-external-dns`,
            policies: [{
                effect: "allow",
                permissionGroups: permissions.zone.apply(perms => [perms["DNS Read"], perms["DNS Write"]]),
                resources: hotstedZoneIds.apply(zones => {
                    return pulumi.all(zones.map(zone => zone.zoneId)).apply(zoneIds => {
                        return Object.fromEntries(zoneIds.map(zoneId => [`com.cloudflare.api.account.zone.${zoneId}`, "*"]));
                    });
                }),
            }],
        }, { parent: this });
    
        const accessToken = new k8s.core.v1.Secret(`${name}-cloudflare-token`, {
            metadata: {
                name: "cloudflare-token",
                namespace: this.namespace.metadata.name,
            },
            stringData: {
                apiKey: cfToken.value,
            },
        }, { parent: this });
    
        this.chart = new k8s.helm.v3.Release(name, {
            namespace: this.namespace.metadata.name,
            chart: "external-dns",
            repositoryOpts: {
                repo: "https://kubernetes-sigs.github.io/external-dns/",
            },
            values: {
                provider: "cloudflare",
                domainFilters: config.parentDomains,
                env: [{
                    name: "CF_API_TOKEN",
                    valueFrom: {
                        secretKeyRef: {
                            name: accessToken.metadata.name,
                            key: "apiKey",
                        }
                    }
                }],
                serviceMonitor: {
                    enabled: true,
                },
            },
            version: config.version,
        }, { parent: this });
    }
}
