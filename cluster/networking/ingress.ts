import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface IngressConfig {
    version: pulumi.Input<string>;
    externalIps: pulumi.Input<pulumi.Input<string>[]>;
}

export function installIngress(name: string, config: IngressConfig,  opts: pulumi.CustomResourceOptions): k8s.helm.v3.Release {
    const ns = new k8s.core.v1.Namespace(name, {
        metadata: {
            name: name,
            labels: {
                "pod-security.kubernetes.io/enforce": "privileged"
            }
        }
    }, opts);
    
    return new k8s.helm.v3.Release(name, {
        chart: "ingress-nginx",
        namespace: ns.metadata.name,
        repositoryOpts: {
            repo: "https://kubernetes.github.io/ingress-nginx",
        },
        values: {
            controller: {
                // hostPort: {
                //     enabled: true
                // },
                kind: "DaemonSet",
                service: {
                    enabled: true,
                    type: "LoadBalancer",
                    // loadBalancerClass: "io.cilium/node",
                    // externalIPs: config.externalIps,
                },
                publishService: {
                    enabled: true
                },
                metrics: {
                    enabled: true
                },
                podAnnotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "10254"
                }
            }
        },
        version: config.version,
    }, opts);
}
