import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const org = pulumi.getOrganization();
const stackRef = new pulumi.StackReference(`${org}/cluster/lab-cluster`)
const kubeconfig = stackRef.getOutput("kubeconfig");
const stackNamespace = stackRef.getOutput("pulumiStackNamespace");
const accessTokenSecret = stackRef.getOutput("accessTokenSecret");
const kube = new k8s.Provider("lab-cluster", { kubeconfig });

const podInfo = new k8s.apiextensions.CustomResource("pod-info", {
    apiVersion: 'pulumi.com/v1',
    kind: 'Stack',
    metadata: {
        namespace: stackNamespace,
    },
    spec: {
        stack: `${org}/lab-pod-info`,
        projectRepo: "https://github.com/flostadler/homelab",
        repoDir: "apps/pod-info",
        commit: "main",
        accessTokenSecret: accessTokenSecret,
        destroyOnFinalize: true,
    }
}, { provider: kube });
