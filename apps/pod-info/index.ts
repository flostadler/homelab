import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const org = pulumi.getOrganization();
const stackRef = new pulumi.StackReference(`${org}/cluster/lab-cluster`)
const kubeconfig = stackRef.getOutput("kubeconfig");
const prodCertIssuer = stackRef.getOutput("prodCertIssuer");
const fqClusterName = stackRef.getOutput("fqClusterName");
const kube = new k8s.Provider("lab-cluster", { kubeconfig });

const ns = new k8s.core.v1.Namespace("podinfo", {
    metadata: {
        name: "podinfo",
    },
}, { provider: kube });
const podInfo = new k8s.helm.v3.Release("podinfo", {
    chart: "podinfo",
    version: "6.7.1",
    repositoryOpts: {
        repo: "https://stefanprodan.github.io/podinfo",
    },
    namespace: ns.metadata.name,
    values: {
        hpa: {
            enabled: true,
            cpu: "90",
        },
        resources: {
            requests: {
                cpu: "100m",
                memory: "500Mi",
            },
            limits: {
                cpu: "500m",
                memory: "500Mi",
            },
        },
        ingress: {
            enabled: "true",
            className: "nginx",
            annotations: {
                "cert-manager.io/cluster-issuer": prodCertIssuer,
            },
            hosts: [{
                host: pulumi.interpolate`podinfo.apps.${fqClusterName}`,
                paths: [{
                    path: "/",
                    pathType: "Prefix",
                }],
            }],
            tls: [{
                hosts: [pulumi.interpolate`podinfo.apps.${fqClusterName}`],
                secretName: `podinfo-tls`,
            }],
        },
    },
}, { provider: kube });
