/**
 * @deprecated Thin compatibility shim — Fix Issues now opens the shared GenerationDrawer
 * via JobsProvider.enqueueRevision / openDrawer. Do not add a second progress UI here.
 */

import { useEffect } from 'react';
import { useEditorialJobsOptional } from './JobsProvider';

export function RevisionBatchPanel({
  jobId,
}: {
  jobId: number | null;
  onRetry?: (jobId: number) => void;
  onDismiss?: () => void;
  onCompleted?: (job: unknown) => void;
}) {
  const jobs = useEditorialJobsOptional();

  useEffect(() => {
    if (jobId != null && jobs) {
      jobs.openDrawer(jobId);
    }
  }, [jobId, jobs]);

  return null;
}
