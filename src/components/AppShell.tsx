'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import AppSidebar from '@/components/AppSidebar';
import { useSettings } from '@/lib/settings';

// Routes that render full-bleed without any chrome (pre-auth).
const HIDE_ROUTES = new Set(['/sign-in']);

/**
 * Renders both chrome variants and lets CSS pick the active one based on
 * `html[data-top-header]` (set by the inline pre-hydration script in
 * layout.tsx). Why render both: mounting / unmounting AppHeader at hydration
 * time inserts a 64px tall element at the top of body, which shifts main
 * content down by 64px on every refresh in top-nav mode. With both always
 * in the DOM and CSS toggling `display: none`, the in-flow space is stable
 * and the page doesn't jump.
 */
export default function AppShell() {
  const pathname = usePathname();
  const { settings, hydrated } = useSettings();
  const hideChrome = HIDE_ROUTES.has(pathname);
  const showSidebar = !hideChrome && settings.layout === 'sidebar';
  const topNav = !hideChrome && settings.layout === 'top-nav';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    // Wait for useSettings to read localStorage before touching the html
    // attributes. Without this guard, the FIRST effect run uses the default
    // settings (`layout: 'sidebar'`) and overwrites whatever the inline
    // pre-hydration script in layout.tsx set — causing a one-frame flash
    // back to sidebar mode for users with `top-nav` saved.
    if (!hydrated) return;
    const root = document.documentElement;
    if (showSidebar) root.removeAttribute('data-no-sidebar');
    else root.setAttribute('data-no-sidebar', '');
    if (topNav) root.setAttribute('data-top-header', '');
    else root.removeAttribute('data-top-header');
    return () => {
      root.removeAttribute('data-no-sidebar');
      root.removeAttribute('data-top-header');
    };
  }, [hydrated, showSidebar, topNav]);

  if (hideChrome) return null;

  return (
    <>
      <AppSidebar />
      <AppHeader />
    </>
  );
}
