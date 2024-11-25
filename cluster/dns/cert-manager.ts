import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface CertManagerArgs {
    version: pulumi.Input<string>;
    contact: pulumi.Input<string>;
    ingressClass: pulumi.Input<string>;
}

export class CertManager extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly certManager: k8s.helm.v3.Release;
    public readonly stagingIssuer: k8s.apiextensions.CustomResource;
    public readonly prodIssuer: k8s.apiextensions.CustomResource;

    constructor(name: string, args: CertManagerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("cluster:dns:CertManager", name, args, opts);

        this.namespace = new k8s.core.v1.Namespace(name, {
            metadata: {
                name: name,
            },
        }, { parent: this });

        this.certManager = new k8s.helm.v3.Release(name, {
            chart: "cert-manager",
            version: args.version,
            repositoryOpts: {
                repo: "https://charts.jetstack.io",
            },
            namespace: this.namespace.metadata.name,
            values: {
                installCRDs: true,
            },
        }, { parent: this });

        this.stagingIssuer = new k8s.apiextensions.CustomResource(`${name}-staging-issuer`, {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                namespace: this.namespace.metadata.name,
                name: "letsencrypt-staging",
            },
            spec: {
                acme: {
                    server: "https://acme-staging-v02.api.letsencrypt.org/directory",
                    email: args.contact,
                    privateKeySecretRef: {
                        name: "letsencrypt-staging",
                    },
                    solvers: [{
                        http01: {
                            ingress: {
                                class: args.ingressClass,
                            },
                        },
                    }]
                }
            }
        }, { parent: this, dependsOn: this.certManager });

        this.prodIssuer = new k8s.apiextensions.CustomResource(`${name}-prod-issuer`, {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                namespace: this.namespace.metadata.name,
                name: "letsencrypt-production",
            },
            spec: {
                acme: {
                    server: "https://acme-v02.api.letsencrypt.org/directory",
                    email: args.contact,
                    privateKeySecretRef: {
                        name: "letsencrypt-production",
                    },
                    solvers: [{
                        http01: {
                            ingress: {
                                class: args.ingressClass,
                            },
                        },
                    }]
                }
            }
        }, { parent: this, dependsOn: this.certManager });
    }
}
