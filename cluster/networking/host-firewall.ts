import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export function createControlPlaneHostFirewall(name: string, nodeIps: pulumi.Input<pulumi.Input<string>[]>, opts: pulumi.CustomResourceOptions): k8s.apiextensions.CustomResource {
    return new k8s.apiextensions.CustomResource(name, {
        apiVersion: "cilium.io/v2",
        kind: "CiliumClusterwideNetworkPolicy",
        metadata: {
            name: name,
        },
        spec: {
            description: "control-plane specific access rules.",
            nodeSelector: {
                matchLabels: {
                    // All our nodes are control planes right now. Need to split this up if the cluster grows
                    "node-role.kubernetes.io/control-plane": "",
                },
            },
            ingress: [
                {
                    // Kube API
                    fromEntities: ["world", "cluster"],
                    toPorts: [
                        {
                            ports: [
                                { port: "6443", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    // Talos
                    fromEntities: ["world", "cluster"],
                    toPorts: [
                        {
                            ports: [
                                { port: "50000", protocol: "TCP" },
                                { port: "50001", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    // KubeSpan Wireguard
                    fromEntities: ["cluster"],
                    toPorts: [
                        {
                            ports: [
                                { port: "51820", protocol: "UDP" },
                            ],
                        },
                    ],
                },
                {
                    // Etcd
                    fromEntities: ["remote-node", "kube-apiserver"],
                    toPorts: [
                        {
                            ports: [
                                { port: "2379", protocol: "TCP" },
                                { port: "2380", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    // Etcd (by node ip, before nodes join the cluster)
                    fromCIDR: pulumi.output(nodeIps).apply(ips => ips.map(ip => `${ip}/32`)),
                    toPorts: [
                        {
                            ports: [
                                { port: "2379", protocol: "TCP" },
                                { port: "2380", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    fromEntities: ["cluster"],
                    toPorts: [
                        {
                            ports: [
                                // Kubelet
                                { port: "10250", protocol: "TCP" },
                                // cilium-agent Prometheus metrics
                                { port: "9090", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    // Cilium
                    fromEntities: ["remote-node"],
                    toPorts: [
                        {
                            ports: [
                                // Cilium WireGuard
                                { port: "51871", protocol: "UDP" },
                                // Cilium VXLAN
                                { port: "8472", protocol: "UDP" },
                            ],
                        },
                    ],
                },
                {
                    // Cilium health
                    fromEntities: ["remote-node", "health"],
                    toPorts: [
                        {
                            ports: [
                                // Cilium health check
                                { port: "4240", protocol: "TCP" },
                                // cilium-agent health status API
                                { port: "9876", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    // Cilium node
                    fromEntities: ["cluster"],
                    toPorts: [
                        {
                            ports: [
                                // Cilium operator metrics
                                { port: "6942", protocol: "TCP" },
                                // Cilium Hubble relay
                                { port: "4244", protocol: "TCP" },
                            ],
                        },
                    ],
                },
                {
                    icmps: [{
                        fields: [
                            { type: "8", family: "IPv4" },
                            { type: "128", family: "IPv6" },
                        ]
                    }]
                },
                {
                    fromEntities: ["world", "cluster"],
                    toPorts: [
                        {
                            ports: [
                                { port: "80", protocol: "TCP" },
                                { port: "443", protocol: "TCP" },
                            ],
                        },
                    ],
                },
            ],
        },
    }, opts);
}
