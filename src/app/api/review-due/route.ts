import { getDailyQueueInfo } from "@/lib/fsrs/scheduler";
import { apiHandlerV2 } from "@/lib/api/handler";

export const GET = apiHandlerV2(async () => {
	const queueInfo = await getDailyQueueInfo();

	return Response.json({
		due: queueInfo.reviewDue + queueInfo.newDue,
		newDue: queueInfo.newDue,
		reviewDue: queueInfo.reviewDue,
		newQueued: queueInfo.newQueued,
		todayNewReviewed: queueInfo.todayNewReviewed,
		todayReviewReviewed: queueInfo.todayReviewReviewed,
		dailyNewLimit: queueInfo.dailyNewLimit,
		dailyReviewLimit: queueInfo.dailyReviewLimit,
		newRemaining: queueInfo.newRemaining,
		reviewRemaining: queueInfo.reviewRemaining,
	});
});
