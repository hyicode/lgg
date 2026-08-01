import { useCallback, useEffect, useState } from "react";
import { canAccessView, publishActiveView, type ViewId } from "../navigation/viewState";

export function useViewNavigation(admin: boolean) {
  const [activeView, setActiveView] = useState<ViewId>("rollView");

  useEffect(() => {
    if (!canAccessView(activeView, admin)) setActiveView("rollView");
  }, [activeView, admin]);

  useEffect(() => {
    publishActiveView(activeView);
  }, [activeView]);

  const navigate = useCallback((view: ViewId) => {
    if (canAccessView(view, admin)) setActiveView(view);
  }, [admin]);

  return { activeView, navigate };
}
