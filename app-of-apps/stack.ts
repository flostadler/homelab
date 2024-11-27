import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const org = pulumi.getOrganization();
const stackRef = new pulumi.StackReference(`${org}/cluster/lab-cluster`)
const kubeconfig = stackRef.getOutput("kubeconfig");
const stackNamespace = stackRef.getOutput("pulumiStackNamespace");
const accessTokenSecret = stackRef.getOutput("accessTokenSecret");
const kube = new k8s.Provider("lab-cluster", { kubeconfig });

export interface StackInfo {
    name: string;
    stack: string;
    repoDir: string;
    branch?: string;
    commit?: string;
}
export function pulumiStack(stack: StackInfo) {
    return new k8s.apiextensions.CustomResource(stack.name, {
        apiVersion: 'pulumi.com/v1',
        kind: 'Stack',
        metadata: {
            namespace: stackNamespace,
        },
        spec: {
            stack: `${org}/${stack.stack}`,
            projectRepo: "https://github.com/flostadler/homelab",
            repoDir: stack.repoDir,
            branch: stack.commit ? undefined : stack.branch ?? "refs/heads/main",
            resyncFrequencySeconds: 60,
            commit: stack.commit,
            accessTokenSecret: accessTokenSecret,
            destroyOnFinalize: true,
        }
    }, { provider: kube });
}
