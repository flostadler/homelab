import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const org = pulumi.getOrganization();
const stackRef = new pulumi.StackReference(`${org}/cluster/lab-cluster`)
const kubeconfig = stackRef.getOutput("kubeconfig");
const prodCertIssuer = stackRef.getOutput("prodCertIssuer");
const fqClusterName = stackRef.getOutput("fqClusterName");
const oidcClientId = stackRef.getOutput("oidcClientId");
const oidcClientSecret = stackRef.getOutput("oidcClientSecret");
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

const host = pulumi.interpolate`grafana.lab.${fqClusterName}`;
const grafanaValues = {
    grafana: {
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
            auth: {
                disable_login_form: true,
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
            },
            security: {
                disable_initial_admin_creation: true,
                cookie_secure: true,
                cookie_samesite: "lax",
            },
            users: {
                allow_sign_up: false,
                auto_assign_org: true,
                auto_assign_org_role: "Viewer",
            },
        },
        authz: {
            github: {
                org_role: {
                    "tracer-labs": "Admin",
                },
            },
        },
        envFromSecrets: [
            {
                name: githubOauthSecret.metadata.name,
            },
        ],
        persistence: {
            enabled: true,
            size: "10Gi",
        },
        resources: {
            limits: {
                cpu: "1000m",
                memory: "1Gi",
            },
            requests: {
                cpu: "200m",
                memory: "512Mi",
            },
        },
        adminPassword: "DUMMY",
    },
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
