import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as talos from "@pulumiverse/talos";
import * as command from "@pulumi/command";
import * as exec from "child_process";

export interface NodeProps {
    zoneId: pulumi.Input<string>;
    name: string;
    ip: pulumi.Input<string>;
    sshKey: pulumi.Input<string>;
    talosVersion: pulumi.Input<string>;
    // kubernetesVersion: pulumi.Input<string>;
    // clusterName: pulumi.Input<string>;
    // clusterEndpoint: pulumi.Input<string>;
    machineSecrets: talos.machine.Secrets;
    machineConfiguration: pulumi.Output<talos.machine.GetConfigurationResult>;
    zone: pulumi.Input<string>;
    floatingIP?: pulumi.Input<string>;
}

export class ClusterNode extends pulumi.ComponentResource {
    public readonly configurationApply: talos.machine.ConfigurationApply;
    public readonly endpoint: pulumi.Output<string>;
    public readonly name: string;
    public readonly ip: pulumi.Output<string>;

    constructor(name: string, args: NodeProps, opts?: pulumi.ComponentResourceOptions) {
        super("cluster:nodes:ClusterNode", name, {}, opts);

        this.name = args.name;
        this.ip = pulumi.output(args.ip);

        const dnsRecord = new cloudflare.Record(name, {
            zoneId: args.zoneId,
            name: `${args.name}.lab`,
            content: args.ip,
            type: "A",
            proxied: false,
        }, { parent: this });

        const bootstrap = new command.remote.Command(`${name}-bootstrap`, {
            connection: {
                host: args.ip,
                privateKey: args.sshKey,
            },
            create: `TALOS_VERSION=${args.talosVersion}
mdadm --stop /dev/md[0-4]

# Wipe disks
sfdisk --delete /dev/nvme[0-1]n1
wipefs -a -f /dev/nvme[0-1]n1

# Download raw talos fs
wget https://github.com/siderolabs/talos/releases/download/$TALOS_VERSION/metal-amd64.raw.zst -O /tmp/metal-amd64.raw.zst
# Replace system with talos
zstdcat --decompress /tmp/metal-amd64.raw.zst | dd of=/dev/nvme0n1

sync
reboot
`,
        }, { parent: this, ignoreChanges: ["*"] });

        // maybe we don't even need this
        // const bootstrapped = pulumi.all([args.ip, bootstrap.stdout]).apply(([ip, _]) => {
        //     return pulumi.output(executeWithExponentialBackoff(`talosctl -n ${ip} disks --insecure`, 30 * 60 * 1000, 30 * 60))
        // });

        this.configurationApply = new talos.machine.ConfigurationApply(name, {
            clientConfiguration: args.machineSecrets.clientConfiguration,
            machineConfigurationInput: args.machineConfiguration.machineConfiguration,

            node: args.ip,
            configPatches: [pulumi.jsonStringify({
                machine: {
                    kubelet: {
                        nodeIP: {
                            validSubnets: [pulumi.interpolate`${args.ip}/32`],
                        }
                    },
                    network: {
                        hostname: args.name,
                        interfaces: [{
                            deviceSelector: {
                                busPath: "0*"
                            },
                            addresses: args.floatingIP ? [args.floatingIP] : undefined,
                            dhcp: true,
                        }]
                    },
                    nodeLabels: {
                        "topology.kubernetes.io/zone": args.zone,
                        "topology.kubernetes.io/region": pulumi.output(args.zone).apply(zone => zone.split("-")[0]),
                    }
                },
                cluster: {
                    etcd: {
                        advertisedSubnets: [pulumi.interpolate`${args.ip}/32`]
                    }
                }
            })],
        }, { parent: this, dependsOn: [dnsRecord, bootstrap] });

        this.endpoint = this.configurationApply.endpoint;
    }
}
