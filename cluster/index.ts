import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as nodes from "./nodes";
import * as networking from './networking'
import * as kubeUtils from './kubernetes'
import * as pulumiOperator from "./pulumi";
import * as dns from "./dns";
import * as storage from "./storage";
import * as metrics from "./metrics";

export interface NodeConfig {
    ip: string,
    name: string,
    zone: string,
    floatingIP?: string,
}

export interface CloudflareConfig {
    token: string,
    account: string,
}

const config = new pulumi.Config();

const talosVersion = config.require("talosVersion");
const talosControllerManagerVersion = config.require("talosControllerManagerVersion");
const kubernetesVersion = config.require("kubernetesVersion");

const nodeConfig = config.requireObject<NodeConfig[]>("nodes");
const sshKey = config.requireSecret("sshKey");
const cloudflareCfg = config.requireSecretObject<CloudflareConfig>("cloudflare");
const cf = new cloudflare.Provider("cloudflare", {
    apiToken: cloudflareCfg.token,
});

const parentDomain = config.require("parentDomain");
const parentZone = cloudflare.getZoneOutput({
    name: parentDomain,
    accountId: cloudflareCfg.account,
}, { provider: cf });

const clusterName = "lab";
export const fqClusterName = `${clusterName}.${parentDomain}`;
const clusterHostname = `cluster.${fqClusterName}`
const clusterEndpoint = `https://${clusterHostname}:6443`;

const secrets = new talos.machine.Secrets("secrets", {
    talosVersion,
});

const controlPlaneConfig = talos.machine.getConfigurationOutput({
    clusterName,
    machineType: "controlplane",
    clusterEndpoint,
    machineSecrets: secrets.machineSecrets,
    talosVersion,
    kubernetesVersion: kubernetesVersion,
    configPatches: [pulumi.jsonStringify({
        machine: {
            certSANs: [clusterHostname],
            install: {
                disk: "/dev/nvme0n1",
            },
            kubelet: {
                extraArgs: {
                    "cloud-provider": "external",
                }
            },
            features: {
                kubernetesTalosAPIAccess: {
                    enabled: true,
                    allowedRoles: ["os:reader"],
                    allowedKubernetesNamespaces: ["kube-system"],
                }
            }
        },
        cluster: {
            clusterName: fqClusterName,
            allowSchedulingOnControlPlanes: true,
            network: {
                // Pulumi Kubernetes operator doesn't support setting this yet
                // dnsDomain: `local.${fqClusterName}`,
                cni: {
                    name: "none",
                }
            },
            proxy: {
                disabled: true,
            },
            externalCloudProvider: {
                enabled: true,
                manifests: [`https://raw.githubusercontent.com/siderolabs/talos-cloud-controller-manager/${talosControllerManagerVersion}/docs/deploy/cloud-controller-manager.yml`]
            }
        },
    })],
});

const clusterNodes = nodeConfig.map((node) => {
    return new nodes.ClusterNode(node.name, {
        name: node.name,
        ip: node.ip,
        sshKey,
        talosVersion,
        machineSecrets: secrets,
        zoneId: parentZone.zoneId,
        machineConfiguration: controlPlaneConfig,
        zone: node.zone,
        floatingIP: node.floatingIP,
    }, { providers: {
        cloudflare: cf,
    } });
});

clusterNodes.forEach((node) => {
    new cloudflare.Record(`cluster-record-${node.name}`, {
        zoneId: parentZone.zoneId,
        name: "cluster.lab",
        content: node.endpoint,
        type: "A",
        proxied: false,
    }, { provider: cf });
});

const bootstrap = new talos.machine.Bootstrap("bootstrap", {
    node: clusterNodes[0].endpoint,
    clientConfiguration: secrets.clientConfiguration,
});

const bootstrapEndpoint = pulumi.interpolate`https://${bootstrap.node}:6443`;
const apiServerHealthy = bootstrapEndpoint.apply(endpoint => kubeUtils.checkApiServerHealth({
    // check the IP of the bootstrap node, when bootstrapping this will be the only API server
    url: endpoint,
    retryConfig: {
        maxTimeout: 30 * 1000 * 60, // 30 minutes
    }
}));

export const kubeconfig = apiServerHealthy.apply(_ => {
    return talos.cluster.getKubeconfigOutput({
        clientConfiguration: secrets.clientConfiguration,
        node: bootstrap.node,
    }).kubeconfigRaw;
});

const bootstrapKubeConfig = pulumi.all([kubeconfig, bootstrapEndpoint]).apply(([kubeconfig, endpoint]) => {
    return kubeconfig.replace(clusterEndpoint, endpoint);
});

export const talosconfig = apiServerHealthy.apply(_ => {
    return talos.client.getConfigurationOutput({
        clusterName,
        clientConfiguration: secrets.clientConfiguration,
        endpoints: clusterNodes.map(node => node.endpoint),
        nodes: clusterNodes.map(node => node.endpoint),
    }).talosConfig;
});

// kubeconfig retrieved from Talos keeps on changing. We should only need to use a new kubeconfig if the talos machine
// secrets change, but I'm too lazy right now to manually assemble the config.
const kube = new k8s.Provider("k8s", {
    kubeconfig: bootstrapKubeConfig,
});

const cilium = networking.installCni("cilium", {
    version: "1.16.4",
    floatingIPs: [...new Set(nodeConfig.map(n => n.floatingIP).filter(x => x !== undefined))],
    nodeIPs: clusterNodes.map(n => pulumi.interpolate`${n.ip}/32`),
}, { provider: kube });
const firewall = networking.createControlPlaneHostFirewall("host-fw-control-plane", clusterNodes.map(n => n.ip), {
    provider: kube,
    dependsOn: cilium,
});

const metricsServer = new metrics.MetricsServer("metrics-server", {
    version: "v3.12.2",
}, {
    providers: [kube],
    dependsOn: [cilium],
});

const rookCeph = new storage.RookCeph("rook-ceph", {
    version: "v1.15.6",
    cephVersion: "v19.2.0",
}, {
    dependsOn: cilium,
    providers: [kube],
})
export const storageClass = rookCeph.storageClass.metadata.name;

const pulumiOperatorVersion = config.require("pulumiOperatorVersion");
const pulOperator = pulumiOperator.createOperator(pulumiOperatorVersion, {
    provider: kube,
    dependsOn: cilium,
});
export const pulumiStackNamespace = new k8s.core.v1.Namespace("pulumi-stacks", {
    metadata: {
        name: "pulumi-stacks",
    },
}, { provider: kube }).metadata.name;

// feedback: It wasn't immediately clear why this is necessary. 
const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("pulumi-stacks-auth-delegator", {
    metadata: {
        name: "pulumi-stacks:default:system:auth-delegator",
    },
    roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "system:auth-delegator",
    },
    subjects: [{
        kind: "ServiceAccount",
        namespace: pulumiStackNamespace,
        name: "default",
    }],
}, { provider: kube });

const accessToken = new k8s.core.v1.Secret("pulumi-access-token", {
    metadata: {
        name: "pulumi-access-token",
        namespace: pulumiStackNamespace,
    },
    stringData: {
        accessToken: config.require("pulumiToken"),
    },
}, { provider: kube });
export const accessTokenSecret = accessToken.metadata.name;

const org = pulumi.getOrganization();
const stackOfStacks = new k8s.apiextensions.CustomResource("stack-of-stacks", {
    apiVersion: 'pulumi.com/v1',
    kind: 'Stack',
    metadata: {
        namespace: pulumiStackNamespace,
    },
    spec: {
        stack: `${org}/lab-app-of-apps`,
        projectRepo: "https://github.com/flostadler/homelab",
        repoDir: "app-of-apps",
        branch: "refs/heads/main",
        accessTokenSecret,
        destroyOnFinalize: true,
    }
}, { provider: kube, dependsOn: [pulOperator] });

const ingress = networking.installIngress("ingress-nginx", {
    version: "4.11.3",
    externalIps: clusterNodes.map(n => n.ip),
}, {
    provider: kube,
    dependsOn: [cilium, firewall]
});

const externalDns = new dns.ExternalDns("external-dns", {
    version: "1.15.0",
    cloudflareAccountId: cloudflareCfg.account,
    clusterName,
    parentDomains: [parentDomain],
}, {
    providers: [cf, kube],
    dependsOn: [cilium, firewall],
});

const certManager = new dns.CertManager("cert-manager", {
    version: "1.16.2",
    contact: "flo.stadler@gmx.net",
    ingressClass: "nginx",
}, {
    providers: [kube],
    dependsOn: [ingress],
});

export const prodCertIssuer = certManager.prodIssuer.metadata.name;
