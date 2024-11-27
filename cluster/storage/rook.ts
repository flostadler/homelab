import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface RookCephArgs {
    version: pulumi.Input<string>;
    cephVersion: pulumi.Input<string>;
}

export class RookCeph extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly rookCeph: k8s.helm.v3.Release;
    public readonly cephCluster: k8s.apiextensions.CustomResource;
    public readonly cephBlockPool: k8s.apiextensions.CustomResource;
    public readonly blockStorageClass: k8s.storage.v1.StorageClass;
    public readonly fileStorageClass: k8s.storage.v1.StorageClass;
    public readonly objectStore: k8s.apiextensions.CustomResource;
    public readonly bucketStorageClass: k8s.storage.v1.StorageClass;

    constructor(name: string, args: RookCephArgs, opts?: pulumi.ComponentResourceOptions) {
        super("cluster:storage:RookCeph", name, args, opts);

        this.namespace = new k8s.core.v1.Namespace(name, {
            metadata: {
                name: name,
                labels: {
                    "pod-security.kubernetes.io/enforce": "privileged"
                }
            },
        }, { parent: this });

        this.rookCeph = new k8s.helm.v3.Release(name, {
            chart: "rook-ceph",
            version: args.version,
            repositoryOpts: {
                repo: "https://charts.rook.io/release",
            },
            namespace: this.namespace.metadata.name,
            values: {
                crds: {
                    enabled: true,
                },
                enableDiscoveryDaemon: true,
            },
        }, { parent: this });

        this.cephCluster = new k8s.apiextensions.CustomResource(`${name}-ceph-cluster`, {
            apiVersion: "ceph.rook.io/v1",
            kind: "CephCluster",
            metadata: {
                name: "rook-ceph",
                namespace: this.namespace.metadata.name,
            },
            spec: {
                cephVersion: {
                    image: pulumi.interpolate`quay.io/ceph/ceph:${args.cephVersion}`,
                },
                dataDirHostPath: "/var/lib/rook",
                mon: {
                    count: 3,
                    allowMultiplePerNode: false,
                },
                dashboard: {
                    enabled: true,
                },
                storage: {
                    useAllNodes: true,
                    useAllDevices: true,
                },
                placement: {
                    all: {
                        tolerations: [{
                            key: "node-role.kubernetes.io/control-plane",
                            operator: "Exists",
                            effect: "NoSchedule",
                        }],
                    }
                }
            }
        }, { parent: this, dependsOn: this.rookCeph });

        this.cephBlockPool = new k8s.apiextensions.CustomResource(`${name}-ceph-block-pool`, {
            apiVersion: "ceph.rook.io/v1",
            kind: "CephBlockPool",
            metadata: {
                name: "block-store",
                namespace: this.namespace.metadata.name,
            },
            spec: {
                failureDomain: "host",
                replicated: {
                    size: 2,
                },
            },
        }, { parent: this, dependsOn: this.cephCluster });

        this.blockStorageClass = new k8s.storage.v1.StorageClass(`${name}-storage-class`, {
            metadata: {
                name: "rook-ceph-block",
                namespace: this.namespace.metadata.name,
            },
            provisioner: "rook-ceph.rbd.csi.ceph.com",
            reclaimPolicy: "Delete",
            allowVolumeExpansion: true,
            parameters: {
                pool: this.cephBlockPool.metadata.name,
                clusterID: this.namespace.metadata.name,
                imageFormat: "2",
                imageFeatures: "layering,fast-diff,object-map,deep-flatten,exclusive-lock",
                "csi.storage.k8s.io/provisioner-secret-name": "rook-csi-rbd-provisioner",
                "csi.storage.k8s.io/provisioner-secret-namespace": this.namespace.metadata.name,
                "csi.storage.k8s.io/controller-expand-secret-name": "rook-csi-rbd-provisioner",
                "csi.storage.k8s.io/controller-expand-secret-namespace": this.namespace.metadata.name,
                "csi.storage.k8s.io/node-stage-secret-name": "rook-csi-rbd-node",
                "csi.storage.k8s.io/node-stage-secret-namespace": this.namespace.metadata.name,
                "csi.storage.k8s.io/fstype": "ext4"
            },
        }, { parent: this, dependsOn: this.cephBlockPool });

        const cephFileSystem = new k8s.apiextensions.CustomResource(`${name}-ceph-filesystem`, {
            apiVersion: "ceph.rook.io/v1",
            kind: "CephFilesystem",
            metadata: {
                name: "cephfs",
                namespace: this.namespace.metadata.name,
            },
            spec: {
                metadataPool: {
                    replicated: {
                        size: 2,
                    },
                },
                dataPools: [{
                    replicated: {
                        size: 2,
                    },
                }],
                metadataServer: {
                    activeCount: 1,
                    activeStandby: true,
                },
            },
        }, { parent: this, dependsOn: this.cephCluster });

        this.fileStorageClass = new k8s.storage.v1.StorageClass(`${name}-file-storage-class`, {
            metadata: {
                name: "rook-ceph-file",
                namespace: this.namespace.metadata.name,
            },
            provisioner: "rook-ceph.cephfs.csi.ceph.com",
            reclaimPolicy: "Delete",
            parameters: {
                clusterID: this.namespace.metadata.name,
                fsName: cephFileSystem.metadata.name,
                "csi.storage.k8s.io/provisioner-secret-name": "rook-csi-cephfs-provisioner",
                "csi.storage.k8s.io/provisioner-secret-namespace": this.namespace.metadata.name,
                "csi.storage.k8s.io/controller-expand-secret-name": "rook-csi-cephfs-provisioner",
                "csi.storage.k8s.io/controller-expand-secret-namespace": this.namespace.metadata.name,
                "csi.storage.k8s.io/node-stage-secret-name": "rook-csi-cephfs-node",
                "csi.storage.k8s.io/node-stage-secret-namespace": this.namespace.metadata.name,
            },
        }, { parent: this, dependsOn: cephFileSystem });

        this.objectStore = new k8s.apiextensions.CustomResource(`${name}-ceph-object-store`, {
            apiVersion: "ceph.rook.io/v1",
            kind: "CephObjectStore",
            metadata: {
                name: "object-store",
                namespace: this.namespace.metadata.name,
            },
            spec: {
                metadataPool: {
                    failureDomain: "host",
                    replicated: {
                        size: 3,
                    },
                },
                dataPool: {
                    failureDomain: "host",
                    erasureCoded: {
                        dataChunks: 2,
                        codingChunks: 1
                    }
                },
                preservePoolsOnDelete: false,
                gateway: {
                    port: 80,
                    instances: 3,
                }
            },
        }, { parent: this, dependsOn: this.cephCluster });

        this.bucketStorageClass = new k8s.storage.v1.StorageClass(`${name}-bucket-storage-class`, {
            metadata: {
                name: "rook-ceph-bucket",
                namespace: this.namespace.metadata.name,
            },
            provisioner: "rook-ceph.ceph.rook.io/bucket",
            reclaimPolicy: "Delete",
            parameters: {
                objectStoreName: this.objectStore.metadata.name,
                objectStoreNamespace: this.namespace.metadata.name,
            },
        }, { parent: this, dependsOn: cephFileSystem });
    }
}
