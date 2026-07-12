import { z } from 'zod';
import { isKubernetesDnsLabel, isKubernetesDnsSubdomain } from '../k8s/names.js';

const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f-\u009f]+$/;

export const kubernetesNameSchema = z.string().min(1).max(253)
  .refine(isKubernetesDnsSubdomain, 'Must be a Kubernetes DNS-compatible name');
export const namespaceSchema = z.string().min(1).max(63)
  .refine(isKubernetesDnsLabel, 'Must be a Kubernetes DNS label');
export const containerNameSchema = namespaceSchema;
export const reasonSchema = z.string().min(1).max(512).regex(NO_CONTROL_CHARACTERS, 'Must not contain control characters');
export const selectorSchema = z.string().max(1024);
export const continuationTokenSchema = z.string().max(4096);
