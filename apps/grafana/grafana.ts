import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface GrafanaArgs {
    version: pulumi.Input<string>,
    namespace: pulumi.Input<string>,
    certIssuer: pulumi.Input<string>,
    host: pulumi.Input<string>,
    fileStorageClass: pulumi.Input<string>,
    adminPassword: pulumi.Input<string>,
    oidcClientId: pulumi.Input<string>,
    oidcClientSecret: pulumi.Input<string>,
    mimirServiceEndpoint: pulumi.Input<string>,
}

export function installGrafana(args: GrafanaArgs, kube: k8s.Provider): k8s.helm.v3.Release {
    const githubOauthSecret = new k8s.core.v1.Secret("github-oidc", {
        metadata: {
            name: "grafana-github-oauth",
            namespace: args.namespace,
        },
        stringData: {
            GITHUB_CLIENT_ID: args.oidcClientId,
            GITHUB_CLIENT_SECRET: args.oidcClientSecret,
        },
    }, { provider: kube });
    
    const adminSecret = new k8s.core.v1.Secret("grafana-admin", {
        metadata: {
            name: "grafana-admin",
            namespace: args.namespace,
        },
        stringData: {
            "admin-user": "admin",
            "admin-password": args.adminPassword,
        },
    }, { provider: kube });

    const grafanaValues = {
        replicas: 2,
        ingress: {
            enabled: true,
            ingressClassName: "nginx",
            annotations: {
                "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                "cert-manager.io/cluster-issuer": args.certIssuer,
            },
            hosts: [args.host],
            tls: [
                {
                    secretName: "grafana-tls",
                    hosts: [args.host],
                },
            ],
        },
        "grafana.ini": {
            server: {
                root_url: pulumi.interpolate`https://${args.host}`,
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
                org_mapping: "@tracer-labs/admin:lab:Admin",
                role_attribute_path: "contains(groups[*], '@tracer-labs/admin') && 'Admin' || ''",
            },
            security: {
                allow_embedding: true,
                cookie_secure: true,
                cookie_samesite: "lax",
            }
        },
        envFromSecrets: [
            {
                name: githubOauthSecret.metadata.name,
            },
        ],
        persistence: {
            enabled: true,
            storageClassName: args.fileStorageClass,
            size: "20Gi",
            accessModes: ["ReadWriteMany"],
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
        },
        datasources: {
            "datasources.yaml": {
                apiVersion: 1,
                datasources: [
                    {
                        name: "Mimir",
                        type: "prometheus",
                        access: "proxy",
                        url: pulumi.interpolate`${args.mimirServiceEndpoint}/prometheus`,
                    },
                ],

            }
        }
    };
    
    return new k8s.helm.v3.Release("grafana", {
        chart: "grafana",
        version: "8.6.2",
        repositoryOpts: {
            repo: "https://grafana.github.io/helm-charts",
        },
        values: grafanaValues,
        namespace: args.namespace,
    }, { provider: kube });
}
