import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface CiliumConfig {
    version: string;
}

export function installCni(name: string, config: CiliumConfig, opts: pulumi.CustomResourceOptions): k8s.helm.v3.Release {
    return new k8s.helm.v3.Release(name, {
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
            kubeProxyReplacement: true,
            k8sServiceHost: "localhost",
            k8sServicePort: "7445",
            loadBalancer: {
                algorithm: "maglev",
            },
            operator: {
                rollOutPods: true,
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
        },
        version: "1.16.4",
    }, opts);
}
