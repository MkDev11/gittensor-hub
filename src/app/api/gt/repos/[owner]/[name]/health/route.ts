import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = await ctx.params;
  try {
    const [profileR, repoR] = await Promise.all([
      withRotation((octokit) => octokit.rest.repos.getCommunityProfileMetrics({ owner: params.owner, repo: params.name })).catch(() => null),
      withRotation((octokit) => octokit.rest.repos.get({ owner: params.owner, repo: params.name })).catch(() => null),
    ]);

    let goodFirstIssues = 0;
    let helpWanted = 0;
    try {
      const [gfi, hw] = await Promise.all([
        withRotation(
          (octokit) => octokit.rest.search.issuesAndPullRequests({
            q: `repo:${params.owner}/${params.name} is:issue is:open label:"good first issue"`,
            per_page: 1,
          }),
          { kind: 'search' },
        ).catch(() => ({ data: { total_count: 0 } })),
        withRotation(
          (octokit) => octokit.rest.search.issuesAndPullRequests({
            q: `repo:${params.owner}/${params.name} is:issue is:open label:"help wanted"`,
            per_page: 1,
          }),
          { kind: 'search' },
        ).catch(() => ({ data: { total_count: 0 } })),
      ]);
      goodFirstIssues = gfi.data.total_count ?? 0;
      helpWanted = hw.data.total_count ?? 0;
    } catch {
      // already defaulted to 0
    }

    const profile = profileR?.data;
    const files = profile?.files ?? null;
    return NextResponse.json({
      healthPercentage: profile?.health_percentage ?? 0,
      openIssues: repoR?.data.open_issues_count ?? 0,
      forks: repoR?.data.forks_count ?? 0,
      stars: repoR?.data.stargazers_count ?? 0,
      goodFirstIssues,
      helpWanted,
      pushedAt: repoR?.data.pushed_at ?? null,
      createdAt: repoR?.data.created_at ?? null,
      isArchived: repoR?.data.archived ?? false,
      standards: {
        license: !!files?.license,
        readme: !!files?.readme,
        contributing: !!files?.contributing,
        codeOfConduct: !!files?.code_of_conduct,
        pullRequestTemplate: !!files?.pull_request_template,
        issueTemplates: !!files?.issue_template,
        securityPolicy: files ? 'security' in files : false,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
