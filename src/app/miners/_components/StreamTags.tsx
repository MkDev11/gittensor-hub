// Reward-stream swatches shown beside a miner's name (palette rows + the overview
// inspector). A miner with no attributable stream gets a single neutral swatch
// rather than a misleading green one. Shared so the two render sites stay in sync.

import styles from '../page.module.css';
import { type MinerView } from '../_lib/miners';
import { ISSUE_COLOR, MAINTAINER_COLOR, NEUTRAL_COLOR, PR_COLOR, streamsOf } from '../_lib/streams';

export default function StreamTags({ view }: { view: MinerView }) {
  const { pr, issue, maintainer } = streamsOf(view);
  return (
    <span className={styles.streamTags}>
      {pr ? <span className={styles.streamTag} style={{ background: PR_COLOR }} title="Pull requests" /> : null}
      {issue ? <span className={styles.streamTag} style={{ background: ISSUE_COLOR }} title="Issue discovery" /> : null}
      {maintainer ? <span className={styles.streamTag} style={{ background: MAINTAINER_COLOR }} title="Maintainer cut" /> : null}
      {!pr && !issue && !maintainer ? (
        <span className={styles.streamTag} style={{ background: NEUTRAL_COLOR }} title="No identified reward stream" />
      ) : null}
    </span>
  );
}
