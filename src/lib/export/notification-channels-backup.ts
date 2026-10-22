/**
 * The notification channels, which a backup deliberately never carries
 * (`NOT_IN_BACKUP_MODELS` says why for each) and a restore therefore clears:
 * a channel, a Web Push endpoint or a pending Telegram deletion from before
 * the restore addresses a chat or a browser the restored account has not
 * been through setup with on this host.
 */
import type { RestoreContext } from "@/lib/export/restore-context";

export async function clearNotificationChannels(
  ctx: RestoreContext,
): Promise<void> {
  const { tx, ownerId } = ctx;
  const channels = await tx.notificationChannel.deleteMany({
    where: { userId: ownerId },
  });
  const subs = await tx.pushSubscription.deleteMany({
    where: { userId: ownerId },
  });
  const tgDel = await tx.telegramScheduledDeletion.deleteMany({
    where: { userId: ownerId },
  });
  ctx.cleared.notificationChannels = channels.count;
  ctx.cleared.pushSubscriptions = subs.count;
  ctx.cleared.telegramScheduledDeletions = tgDel.count;
}
