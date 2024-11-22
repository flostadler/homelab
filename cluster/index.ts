import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as nodes from "./nodes";
import * as networking from './networking'
import * as kubeUtils from './kubernetes'

export interface NodeConfig {
    ip: string,
    name: string,
    zone: string,
}

export interface CloudflareConfig {
    token: string,
    account: string,
}

const config = new pulumi.Config();

const talosVersion = config.require("talosVersion");
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
const fqClusterName = `${clusterName}.${parentDomain}`;
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
        },
        cluster: {
            clusterName: fqClusterName,
            allowSchedulingOnControlPlanes: true,
            network: {
                dnsDomain: `local.${fqClusterName}`,
                cni: {
                    name: "none",
                }
            },
            proxy: {
                disabled: true,
            },
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

const apiServerHealthy = pulumi.output(kubeUtils.checkApiServerHealth({
    url: clusterEndpoint,
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
    kubeconfig,
});

const cilium = networking.installCni("cilium", { version: "1.16.4" }, { provider: kube });
const firewall = networking.createControlPlaneHostFirewall("host-fw-control-plane", clusterNodes.map(n => n.ip), { provider: kube })

// todo add cert manager
// todo add gateway API with a cert
// add gateway for internal tools (e.g. grafana)
// add gateway for services
