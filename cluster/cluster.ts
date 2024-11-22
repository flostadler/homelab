import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as hcloud from "@pulumi/hcloud";
import * as tls from "@pulumi/tls";
import * as talos from "@pulumiverse/talos";
import * as cmd from "@pulumi/command";

import { buildImage } from "./machine-image";

export interface ControlPlaneLB {
    id: pulumi.Output<string>;
    loadBalancerNetwork: hcloud.LoadBalancerNetwork;
}

export interface ControlPlaneArgs {
    generation: string;
    replicas: number;
    image: pulumi.Output<number>;
    serverType: pulumi.Output<string>;
    locations: pulumi.Output<string[]>;
    labels?: pulumi.Output<{ [key: string]: string }>;
    firewalls: hcloud.Firewall[];
    networks: hcloud.Network[];
    placementGroup: hcloud.PlacementGroup;
    userData: pulumi.Output<string>;
    subnetId: pulumi.Output<string>;
    talosClientConfiguration: pulumi.Output<string>;
    kubeConfig: pulumi.Output<string>;
    controlPlaneLB: ControlPlaneLB,
}

export interface Node {
    server: hcloud.Server;
    networkAssignment: hcloud.ServerNetwork;
}

export function createControlPlaneNodes(args: ControlPlaneArgs, provider: hcloud.Provider): Node[] {
    const controlPlaneNodes: Node[] = [];
    // serialize the creation of the control plane nodes
    let controlPlaneSequence: pulumi.Output<string | undefined> = pulumi.output(undefined);
    for (let i = 0; i < args.replicas; i++) {
        const server: hcloud.Server = new hcloud.Server(`control-plane-${args.generation}-${i}`, {
            image: args.image.apply(id => String(id)),
            serverType: controlPlaneSequence.apply(_ => args.serverType),
            location: args.locations.apply(locs => locs[i % locs.length]),
            labels: args.labels,
            firewallIds: args.firewalls.map(fw => fw.id.apply(id => Number(id))),
            networks: args.networks.map(nw => { return { networkId: nw.id.apply(id => Number(id)) } }),
            placementGroupId: args.placementGroup.id.apply(id => Number(id)),
            shutdownBeforeDeletion: true,
            userData: args.userData,
        }, {
            provider,
            // We have a 5 server limit on Hetzner, so we need to delete the server before replacing it. Should be changed in the future.
            deleteBeforeReplace: true,
        });
        controlPlaneSequence = server.ipv4Address;
    
        // todo this should also do kubectl node delete
        new cmd.local.Command(`control-plane-reset-${args.generation}-${i}`, {
            delete: pulumi.interpolate`talosctl --talosconfig <(echo $TALOSCONFIG_CONTENT) -n ${server.ipv4Address} reset | true`,
            interpreter: [
                "/bin/bash",
                "-c",
            ],
            environment: {
                TALOSCONFIG_CONTENT: args.talosClientConfiguration,
            },
            triggers: [server.id],
        }, {
            deleteBeforeReplace: true,
        });

        const networkAssignment = new hcloud.ServerNetwork(`control-plane-${args.generation}-${i}`, {
            subnetId: args.subnetId,
            serverId: server.id.apply(id => Number(id)),
        }, { provider });
    
        const lbTarget = new hcloud.LoadBalancerTarget(`control-plane-${args.generation}-${i}`, {
            loadBalancerId: args.controlPlaneLB.id.apply(id => Number(id)),
            type: "server",
            serverId: server.id.apply(id => Number(id)),
            usePrivateIp: true,
        }, { provider, dependsOn: [networkAssignment, args.controlPlaneLB.loadBalancerNetwork] });
    
        controlPlaneNodes.push({ server, networkAssignment });
    }

    return controlPlaneNodes;
}