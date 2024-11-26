import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface MetricsServerConfig {
    version: pulumi.Input<string>,
}

export class MetricsServer extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly release: k8s.helm.v3.Release;

    constructor(name: string, config: MetricsServerConfig, opts?: pulumi.ComponentResourceOptions) {
        super("cluster:metrics:MetricsServer", name, config, opts);

        this.namespace = new k8s.core.v1.Namespace(name, {
            metadata: {
                name: name,
            },
        }, { parent: this });
    
        this.release = new k8s.helm.v3.Release(name, {
            namespace: this.namespace.metadata.name,
            chart: "metrics-server",
            repositoryOpts: {
                repo: "https://kubernetes-sigs.github.io/metrics-server/",
            },
            values: {
                args: ["--kubelet-insecure-tls"],
            },
            version: config.version,
        }, { parent: this });
    }
}
