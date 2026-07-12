const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Return whether a value is a Kubernetes DNS label (for example, a namespace). */
export function isKubernetesDnsLabel(value: string): boolean {
  return value.length <= 63 && DNS_LABEL.test(value);
}

/** Return whether a value is a Kubernetes DNS subdomain name. */
export function isKubernetesDnsSubdomain(value: string): boolean {
  return value.length <= 253 && value.split('.').every(isKubernetesDnsLabel);
}
