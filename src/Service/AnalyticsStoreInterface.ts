export interface AnalyticsStoreInterface {
  incrementSNJSVersionUsage(snjsVersion: string): Promise<void>
  incrementApplicationVersionUsage(applicationVersion: string): Promise<void>
  getYesterdaySNJSUsage(): Promise<Array<{ version: string, count: number }>>
  getYesterdayApplicationUsage(): Promise<Array<{ version: string, count: number }>>
}