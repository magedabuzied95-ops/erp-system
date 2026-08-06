export type RecommendationType = "Quick Reply" | "Suggested Action" | "Suggestion" | "Warning" | (string & {});
export type FeedbackEventType = "Accepted" | "Rejected" | "Ignored" | "Executed" | "Manual Override" | "Execution Result";
export interface RecommendationIdentity { recommendationId: string; recommendationType: RecommendationType; userId: string; conversationId: string; customerId: string; }
export interface RecommendationRecord extends RecommendationIdentity { createdAt: string; source: string; confidence: number; userRole?: string; team?: string; metadata: Readonly<Record<string, unknown>>; }
export interface FeedbackEvent extends RecommendationIdentity { eventId: string; eventType: FeedbackEventType; occurredAt: string; executionTime?: number; userResponseTime?: number; successful?: boolean; overrideValue?: unknown; result?: Readonly<Record<string, unknown>>; }
export interface RecommendationState extends RecommendationRecord { accepted: boolean; rejected: boolean; ignored: boolean; executed: boolean; manuallyOverridden: boolean; executionTime: number | null; userResponseTime: number | null; successful: boolean | null; }
export interface RecommendationQuality { recommendationId: string; successScore: number; failureScore: number; confidenceDelta: number; }
export interface LearningMetrics { totalRecommendations: number; acceptanceRate: number; rejectionRate: number; ignoreRate: number; executionRate: number; averageDecisionTime: number; averageUserResponseTime: number; topAcceptedRecommendationTypes: readonly TypeMetric[]; topRejectedRecommendationTypes: readonly TypeMetric[]; }
export interface TypeMetric { type: string; count: number; rate: number; }
export interface CopilotFeedbackMetrics { quickReplyUsage: number; suggestedActionUsage: number; suggestionAcceptance: number; warningUsefulness: number; }
export interface RecommendationAnalytics { metrics: LearningMetrics; copilot: CopilotFeedbackMetrics; byType: readonly TypeAnalytics[]; }
export interface TypeAnalytics { type: string; total: number; accepted: number; rejected: number; ignored: number; executed: number; successRate: number; }
export interface QualityReport { generatedAt: string; recommendations: readonly RecommendationQuality[]; averageSuccessScore: number; averageFailureScore: number; averageConfidenceDelta: number; }
export interface LearningInsight { statement: string; evidenceCount: number; confidence: number; }
export interface LearningReport { generatedAt: string; analytics: RecommendationAnalytics; quality: QualityReport; insights: readonly LearningInsight[]; }
export interface TrainingExample { input: Readonly<Record<string, unknown>>; recommendation: RecommendationRecord; feedback: readonly FeedbackEvent[]; outcome: RecommendationQuality; }

