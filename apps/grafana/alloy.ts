import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface AlloyConfig {
    version: pulumi.Input<string>;
    mimirServiceEndpoint: pulumi.Input<string>;
}

export class Alloy extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly release: k8s.helm.v3.Release;

    constructor(name: string, config: AlloyConfig, opts: pulumi.ComponentResourceOptions = {}) {
        super("apps:grafana:alloy", name, config, opts);

        // Create a namespace for the component
        this.namespace = new k8s.core.v1.Namespace(name, {
            metadata: {
                name: name,
                labels: {
                    "pod-security.kubernetes.io/enforce": "privileged"
                }
            },
        }, { parent: this });

        // Create a Helm chart for the component
        this.release = new k8s.helm.v3.Release(name, {
            namespace: this.namespace.metadata.name,
            chart: "alloy",
            version: config.version,
            repositoryOpts: {
                repo: "https://grafana.github.io/helm-charts",
            },
            values: {
                alloy: {
                    clustering: {
                        enabled: true,
                    },
                    configMap: {
                        content: pulumi.interpolate`
                            logging {
                                level = "info"
                                format = "logfmt"
                            }
                            discovery.kubernetes "pods" {
                                role = "pod"
                            }
                            discovery.kubernetes "nodes" {
                                role = "node"
                            }
                            discovery.kubernetes "services" {
                                role = "service"
                                namespaces {
                                    names = ["kube-system"]
                                }
                            }
                            discovery.relabel "metrics" {
                                targets = discovery.kubernetes.pods.targets
                                rule {
                                    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_port"]
                                    target_label  = "__meta_kubernetes_pod_container_port_number"
                                    action = "keepequal"
                                }
                                rule {
                                    source_labels = ["__meta_kubernetes_pod_container_port_number"]
                                    regex = ""
                                    action = "drop"
                                }    
                                rule {
                                    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_path"]
                                    target_label  = "__metrics_path__"
                                    separator = ""
                                    action = "replace"
                                }        
                            }
                            prometheus.scrape "metrics" {
                                clustering {
                                    enabled = true
                                }
                                targets    = discovery.relabel.metrics.output
                                forward_to = [prometheus.remote_write.metrics.receiver]
                                scrape_interval = "30s"
                            }
                            prometheus.scrape "service_metrics" {
                                clustering {
                                    enabled = true
                                }
                                targets    = discovery.kubernetes.services.targets
                                forward_to = [prometheus.remote_write.metrics.receiver]
                                scrape_interval = "30s"
                            }
                            discovery.relabel "pods_metrics" {
                                targets = discovery.kubernetes.nodes.targets
                                rule {
                                    replacement  = "kubernetes.default.svc:443"
                                    target_label = "__address__"
                                }
                                rule {
                                    regex         = "(.+)"
                                    replacement   = "/api/v1/nodes/$1/proxy/metrics/cadvisor"
                                    source_labels = ["__meta_kubernetes_node_name"]
                                    target_label  = "__metrics_path__"
                                }
                            }
                            prometheus.scrape "pods_metrics" {
                                clustering {
                                    enabled = true
                                }
                                targets      = discovery.relabel.pods_metrics.output
                                job_name     = "integrations/kubernetes/kubelet"
                                scheme       = "https"
                                honor_labels = true
                                forward_to = [prometheus.remote_write.metrics.receiver]
                                bearer_token_file = "/run/secrets/kubernetes.io/serviceaccount/token"
                                tls_config {
                                    insecure_skip_verify = true
                                    server_name          = "kubernetes"
                                }
                                scrape_interval = "30s"
                            }
                            prometheus.exporter.unix "os_metrics" { }
                            prometheus.scrape "os_metrics" {
                                clustering {
                                    enabled = true
                                }
                                targets    = prometheus.exporter.unix.os_metrics.targets
                                forward_to = [prometheus.remote_write.metrics.receiver]
                                scrape_interval = "30s"
                            }

                            prometheus.operator.servicemonitors "service_monitor" {
                                forward_to = [prometheus.remote_write.metrics.receiver]
                            }
                            prometheus.remote_write "metrics" {
                                endpoint {
                                    url = "${config.mimirServiceEndpoint}/api/v1/push"
                                }
                            }
                        `,
                    },
                },
            },
        }, { parent: this });
    }
}
