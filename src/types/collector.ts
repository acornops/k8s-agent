export interface Collector {
  name: string;
  collect(): Promise<any>;
}
