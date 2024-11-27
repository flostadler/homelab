import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import * as grafana from "./grafana";
import * as mimir from "./mimir";
import * as alloy from "./alloy";

const config = new pulumi.Config();
const org = pulumi.getOrganization();
const stackRef = new pulumi.StackReference(`${org}/cluster/lab-cluster`)
const kubeconfig = stackRef.getOutput("kubeconfig");
const prodCertIssuer = stackRef.getOutput("prodCertIssuer");
const fqClusterName = stackRef.getOutput("fqClusterName");
const fileStorageClass = stackRef.getOutput("fileStorageClass");
const bucketStorageClass = stackRef.getOutput("bucketStorageClass");
const blockStorageClass = stackRef.getOutput("blockStorageClass");

const oidcClientId = config.requireSecret("oidcClientId");
const oidcClientSecret = config.requireSecret("oidcClientSecret");
const kube = new k8s.Provider("lab-cluster", { kubeconfig });

const ns = new k8s.core.v1.Namespace("monitoring", {
    metadata: {
        name: "monitoring",
    },
}, { provider: kube });

export const adminPassword = new random.RandomPassword("password", {
    length: 16,
    special: true,
    overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
}).result;

const host = pulumi.interpolate`grafana.${fqClusterName}`;

const mimirRelease = new mimir.Mimir("mimir", {
    version: "5.5.1",
    bucketStorageClass: bucketStorageClass,
    storageClass: blockStorageClass,
}, {
    providers: [kube],
});

const grafanaRelease = grafana.installGrafana({
    version: "8.6.2",
    namespace: ns.metadata.name,
    certIssuer: prodCertIssuer,
    host,
    fileStorageClass,
    adminPassword,
    oidcClientId,
    oidcClientSecret,
    mimirServiceEndpoint: mimirRelease.serviceEndpoint,
}, kube);

const alloyRelease = new alloy.Alloy("alloy", {
    version: "0.10.0",
    mimirServiceEndpoint: mimirRelease.serviceEndpoint,
}, { providers: [kube] });

