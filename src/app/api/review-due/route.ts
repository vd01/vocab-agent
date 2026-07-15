import { getDailyQueueInfo } from '@/lib/fsrs/scheduler';

export async function GET() {
  const queueInfo = await getDailyQueueInfo();

  return Response.json({
    due: queueInfo.reviewDue + queueInfo.newDue,  // backward compat
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
}
