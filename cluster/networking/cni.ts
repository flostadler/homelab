import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface CiliumConfig {
    version: pulumi.Input<string>;
    floatingIPs: pulumi.Input<pulumi.Input<string>[]>;
    nodeIPs: pulumi.Input<pulumi.Input<string>[]>;
}

export function installCni(name: string, config: CiliumConfig, opts: pulumi.CustomResourceOptions): k8s.helm.v3.Release {
    const release = new k8s.helm.v3.Release(name, {
        chart: "cilium",
        namespace: "kube-system",
        repositoryOpts: {
            repo: "https://helm.cilium.io",
        },
        values: {
            rollOutCiliumPods: true,
            encryption: {
                enabled: true,
                type: "wireguard",
            },
            prometheus: {
                enabled: true,
            },
            kubeProxyReplacement: true,
            k8sServiceHost: "localhost",
            k8sServicePort: "7445",
            loadBalancer: {
                algorithm: "maglev",
            },
            operator: {
                rollOutPods: true,
                prometheus: {
                    enabled: true,
                },
            },
            gatewayAPI: {
                enabled: true,
                hostNetwork: {
                    enabled: true,
                },
            },
            envoy: {
                rollOutPods: true,
            },
            securityContext: {
                capabilities: {
                    ciliumAgent: [
                        "CHOWN",
                        "KILL",
                        "NET_ADMIN",
                        "NET_RAW",
                        "IPC_LOCK",
                        "SYS_ADMIN",
                        "SYS_RESOURCE",
                        "DAC_OVERRIDE",
                        "FOWNER",
                        "SETGID",
                        "SETUID"
                    ],
                    cleanCiliumState: [
                        "NET_ADMIN",
                        "SYS_ADMIN",
                        "SYS_RESOURCE",
                    ],
                },
            },
            cgroup: {
                autoMount: {
                    enabled: false,
                },
                hostRoot: "/sys/fs/cgroup",
            },
            hostFirewall: {
                enabled: true,
            },
            hubble: {
                metrics: {
                    enableOpenMetrics: true,
                    enabled: [
                        "dns",
                        "drop",
                        "tcp",
                        "flow",
                        "port-distribution",
                        "icmp",
                        "httpV2:exemplars=true;labelsContext=source_ip,source_namespace,source_workload,destination_ip,destination_namespace,destination_workload,traffic_direction"
                    ]
                }
            }
            // nodeIPAM: {
            //     enabled: true,
            // }
            // nodePort: {
            //     addresses: config.nodeIPs,
            // }
        },
        version: config.version,
    }, opts);

    const loadBalancerIPAM = new k8s.apiextensions.CustomResource(`${name}-load-balancer-ipam`, {
        apiVersion: "cilium.io/v2alpha1",
        kind: "CiliumLoadBalancerIPPool",
        metadata: {
            namespace: "kube-system",
            name: "floating-ip",
        },
        spec: {
            blocks: pulumi.output(config.floatingIPs).apply(ips => ips.map(ip => ({ cidr: ip }))),
        }
    }, { ...opts, dependsOn: release });

    return release;
}
