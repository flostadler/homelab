import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface MimirConfig {
    version: pulumi.Input<string>,
    storageClass: pulumi.Input<string>,
    bucketStorageClass: pulumi.Input<string>,
}

export class Mimir extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly release: k8s.helm.v3.Release;
    public readonly serviceEndpoint: pulumi.Output<string>;

    constructor(name: string, config: MimirConfig, opts?: pulumi.ComponentResourceOptions) {
        super("apps:grafana:Mimir", name, config, opts);

        this.namespace = new k8s.core.v1.Namespace(name, {
            metadata: {
                name: name,
            },
        }, { parent: this });

        const mimirBucket = new k8s.apiextensions.CustomResource(`${name}-obc`, {
            apiVersion: "objectbucket.io/v1alpha1",
            kind: "ObjectBucketClaim",
            metadata: {
                name: "mimir",
                namespace: this.namespace.metadata.name,
            },
            spec: {
                generateBucketName: "mimir",
                storageClassName: config.bucketStorageClass,
            },
        }, { parent: this });

        this.release = new k8s.helm.v3.Release(name, {
            namespace: this.namespace.metadata.name,
            chart: "mimir-distributed",
            repositoryOpts: {
                repo: "https://grafana.github.io/helm-charts",
            },
            values: {
                ...getMimirPreset(config.storageClass),
                global: {
                    extraEnvFrom: [
                        {
                            secretRef: {
                                name: mimirBucket.metadata.name
                            }
                        },
                        {
                            configMapRef: {
                                name: mimirBucket.metadata.name
                            }
                        }
                    ],
                },
                mimir: {
                    structuredConfig: {
                        alertmanager_storage: {
                            s3: {
                                bucket_name: "${BUCKET_NAME}",
                                access_key_id: "${AWS_ACCESS_KEY_ID}",
                                endpoint: "${BUCKET_HOST}:${BUCKET_PORT}",
                                insecure: true,
                                secret_access_key: "${AWS_SECRET_ACCESS_KEY}"
                            },
                            storage_prefix: "alertmanager"
                        },
                        blocks_storage: {
                            backend: "s3",
                            s3: {
                                bucket_name: "${BUCKET_NAME}",
                                access_key_id: "${AWS_ACCESS_KEY_ID}",
                                endpoint: "${BUCKET_HOST}:${BUCKET_PORT}",
                                insecure: true,
                                secret_access_key: "${AWS_SECRET_ACCESS_KEY}"
                            },
                            storage_prefix: "blocks"
                        },
                        ruler_storage: {
                            s3: {
                                bucket_name: "${BUCKET_NAME}",
                                access_key_id: "${AWS_ACCESS_KEY_ID}",
                                endpoint: "${BUCKET_HOST}:${BUCKET_PORT}",
                                insecure: true,
                                secret_access_key: "${AWS_SECRET_ACCESS_KEY}"
                            },
                            storage_prefix: "ruler"
                        }
                    }
                }
            },
            version: config.version,
        }, { parent: this });

        this.serviceEndpoint = pulumi.interpolate`http://${this.release.name}-nginx.${this.namespace.metadata.name}.svc.cluster.local:80`;
    }
}

function getMimirPreset(storageClass: pulumi.Input<string>) {
    return {
    alertmanager: {
        persistentVolume: { enabled: true, storageClass },
        replicas: 2,
        resources: {
            limits: { memory: "1.4Gi" },
            requests: { cpu: "500m", memory: "1Gi" }
        },
        statefulSet: { enabled: true }
    },
    compactor: {
        persistentVolume: { size: "20Gi", storageClass },
        resources: {
            limits: { memory: "2.1Gi" },
            requests: { cpu: "500m", memory: "1.5Gi" }
        }
    },
    distributor: {
        replicas: 2,
        resources: {
            limits: { memory: "5.7Gi" },
            requests: { cpu: 1, memory: "4Gi" }
        }
    },
    ingester: {
        extraEnvFrom: [

        ],
        persistentVolume: { size: "50Gi", storageClass },
        replicas: 2,
        resources: {
            limits: { memory: "12Gi" },
            requests: { cpu: 1.5, memory: "8Gi" }
        },
        topologySpreadConstraints: {},
        affinity: {
            podAntiAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: [
                    {
                        labelSelector: {
                            matchExpressions: [{
                                key: "target",
                                operator: "In",
                                values: ["ingester"]
                            }]
                        },
                        topologyKey: "kubernetes.io/hostname"
                    },
                    {
                        labelSelector: {
                            matchExpressions: [{
                                key: "app.kubernetes.io/component",
                                operator: "In",
                                values: ["ingester"]
                            }]
                        },
                        topologyKey: "kubernetes.io/hostname"
                    }
                ]
            }
        },
        zoneAwareReplication: {
            topologyKey: "kubernetes.io/hostname"
        }
    },
    "admin-cache": { enabled: true, replicas: 2 },
    "chunks-cache": { enabled: true, replicas: 2 },
    "index-cache": { enabled: true, replicas: 2 },
    "metadata-cache": { enabled: true },
    "results-cache": { enabled: true, replicas: 2 },
    minio: { enabled: false },
    overrides_exporter: {
        replicas: 1,
        resources: {
            limits: { memory: "128Mi" },
            requests: { cpu: "100m", memory: "128Mi" }
        }
    },
    querier: {
        replicas: 1,
        resources: {
            limits: { memory: "5.6Gi" },
            requests: { cpu: 1, memory: "4Gi" }
        }
    },
    query_frontend: {
        replicas: 1,
        resources: {
            limits: { memory: "2.8Gi" },
            requests: { cpu: "500m", memory: "2Gi" }
        }
    },
    ruler: {
        replicas: 1,
        resources: {
            limits: { memory: "2.8Gi" },
            requests: { cpu: "500m", memory: "2Gi" }
        }
    },
    store_gateway: {
        persistentVolume: { size: "10Gi", storageClass },
        replicas: 2,
        resources: {
            limits: { memory: "2.1Gi" },
            requests: { cpu: "500m", memory: "1.5Gi" }
        },
        topologySpreadConstraints: {},
        affinity: {
            podAntiAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: [
                    {
                        labelSelector: {
                            matchExpressions: [{
                                key: "target",
                                operator: "In",
                                values: ["store-gateway"]
                            }]
                        },
                        topologyKey: "kubernetes.io/hostname"
                    },
                    {
                        labelSelector: {
                            matchExpressions: [{
                                key: "app.kubernetes.io/component",
                                operator: "In",
                                values: ["store-gateway"]
                            }]
                        },
                        topologyKey: "kubernetes.io/hostname"
                    }
                ]
            }
        },
        zoneAwareReplication: {
            topologyKey: "kubernetes.io/hostname"
        }
    },
    nginx: {
        replicas: 1,
        resources: {
            limits: { memory: "731Mi" },
            requests: { cpu: "500m", memory: "512Mi" }
        }
    },
    admin_api: {
        replicas: 1,
        resources: {
            limits: { memory: "128Mi" },
            requests: { cpu: "100m", memory: "64Mi" }
        }
    },
    gateway: {
        replicas: 1,
        resources: {
            limits: { memory: "731Mi" },
            requests: { cpu: "500m", memory: "512Mi" }
        }
    }
}
}
