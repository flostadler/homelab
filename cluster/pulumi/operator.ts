import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export function createOperator(version: pulumi.Input<string>, opts: pulumi.CustomResourceOptions): k8s.kustomize.v2.Directory {
    return new k8s.kustomize.v2.Directory("operator", {
        directory: pulumi.interpolate`https://github.com/pulumi/pulumi-kubernetes-operator//operator/config/default/?ref=${version}`,
    }, opts);
}
