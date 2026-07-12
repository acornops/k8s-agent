export interface WriteReceipt {
  success: true;
  operationId: string;
  target: {
    kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
    namespace: string;
    name: string;
    uid: string;
  };
  change:
    | { type: 'restart'; restartedAt: string }
    | {
        type: 'scale';
        previousReplicas: number;
        requestedReplicas: number;
        hpaOverride: boolean;
      };
  observed: {
    resourceVersion: string;
    generation?: number;
  };
  warnings?: string[];
}
