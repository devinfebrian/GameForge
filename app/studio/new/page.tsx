import { requireUser } from "@/lib/dal";
import { StudioWorkspace } from "../_components/StudioWorkspace";

/**
 * A workspace with no game attached. It renders the same component as an
 * existing game so the prompt, stepper and preview exist in exactly one place;
 * the first completed run navigates to `/studio/[gameId]`.
 */
export default async function NewGamePage() {
  await requireUser();

  return (
    <StudioWorkspace
      gameId={null}
      title={null}
      currentVersionId={null}
      versions={[]}
      messages={[]}
    />
  );
}
