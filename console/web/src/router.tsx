import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { Dashboard } from './views/Dashboard';
import { JobView } from './views/JobView';
import { Shell } from './views/Shell';

const rootRoute = createRootRoute({ component: Shell });

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard });

const jobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs/$jobId',
  validateSearch: (search: Record<string, unknown>): { goal?: string } =>
    typeof search['goal'] === 'string' ? { goal: search['goal'] } : {},
  component: function JobRoute() {
    const { jobId } = jobRoute.useParams();
    const { goal } = jobRoute.useSearch();
    return <JobView key={jobId} jobId={jobId} goal={goal} />;
  },
});

export const router = createRouter({ routeTree: rootRoute.addChildren([dashboardRoute, jobRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
