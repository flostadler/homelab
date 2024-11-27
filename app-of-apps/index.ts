import * as stack from "./stack";

// const podInfo = stack.pulumiStack({ name: "pod-info", stack: "lab-pod-info", repoDir: "apps/pod-info" });
const grafana = stack.pulumiStack({ name: "grafana", stack: "lab-grafana", repoDir: "apps/grafana" });
