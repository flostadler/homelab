import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const org = pulumi.getOrganization();
const stackRef = new pulumi.StackReference(`${org}/cluster/lab-cluster`)
const kubeconfig = stackRef.getOutput("kubeconfig");
const prodCertIssuer = stackRef.getOutput("prodCertIssuer");
const fqClusterName = stackRef.getOutput("fqClusterName");
const storageClass = stackRef.getOutput("storageClass");

const oidcClientId = config.requireSecret("oidcClientId");
const oidcClientSecret = config.requireSecret("oidcClientSecret");
const kube = new k8s.Provider("lab-cluster", { kubeconfig });

const ns = new k8s.core.v1.Namespace("monitoring", {
    metadata: {
        name: "monitoring",
    },
}, { provider: kube });

const githubOauthSecret = new k8s.core.v1.Secret("github-oidc", {
    metadata: {
        name: "grafana-github-oauth",
        namespace: ns.metadata.name,
    },
    stringData: {
        GITHUB_CLIENT_ID: oidcClientId,
        GITHUB_CLIENT_SECRET: oidcClientSecret,
    },
}, { provider: kube });

const adminPassword = new random.RandomPassword("password", {
    length: 16,
    special: true,
    overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
});

const adminSecret = new k8s.core.v1.Secret("grafana-admin", {
    metadata: {
        name: "grafana-admin",
        namespace: ns.metadata.name,
    },
    stringData: {
        "admin-user": "admin",
        "admin-password": adminPassword.result,
    },
}, { provider: kube });

const host = pulumi.interpolate`grafana.lab.${fqClusterName}`;
const grafanaValues = {
    
    ingress: {
        enabled: true,
        ingressClassName: "nginx",
        annotations: {
            "nginx.ingress.kubernetes.io/ssl-redirect": "true",
            "cert-manager.io/cluster-issuer": prodCertIssuer,
        },
        hosts: [host],
        tls: [
            {
                secretName: "grafana-tls",
                hosts: [host],
            },
        ],
    },
    "grafana.ini": {
        server: {
            root_url: pulumi.interpolate`https://${host}`,
        },
        "auth.github": {
            enabled: true,
            allow_sign_up: true,
            client_id: "${GITHUB_CLIENT_ID}",
            client_secret: "${GITHUB_CLIENT_SECRET}",
            scopes: "user:email,read:org",
            auth_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            api_url: "https://api.github.com/user",
            allowed_organizations: "tracer-labs",
            role_attribute_strict: true,
            org_mappings: "tracer-labs:Admin",
        },
    },
    envFromSecrets: [
        {
            name: githubOauthSecret.metadata.name,
        },
    ],
    persistence: {
        enabled: true,
        storageClassName: storageClass,
        size: "10Gi",
    },
    resources: {
        limits: {
            cpu: "2000m",
            memory: "2Gi",
        },
        requests: {
            cpu: "200m",
            memory: "2Gi",
        },
    },
    admin: {
        existingSecret: adminSecret.metadata.name,
    }
};

const grafana = new k8s.helm.v3.Release("grafana", {
    chart: "grafana",
    version: "8.6.2",
    repositoryOpts: {
        repo: "https://grafana.github.io/helm-charts",
    },
    values: grafanaValues,
    namespace: ns.metadata.name,
}, { provider: kube });
