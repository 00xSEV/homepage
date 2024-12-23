import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {
      // GitHub: "https://github.com/jackyzha0/quartz",
      // "Discord Community": "https://discord.gg/cRFFHYye7t",
    },
  }),
}
const Explorer = Component.Explorer({
  title: "Posts",
  // based on quartz/components/Explorer.tsx
  sortFn: (a, b) => {
    // Sort order: folders first, then files. Sort folders and files alphabetically
    if ((!a.file && !b.file) || (a.file && b.file)) {
      return a.file?.dates?.modified && b.file?.dates?.modified
        ? (a.file.dates.modified < b.file.dates.modified ? 1 : -1)
        : 0
    }

    if (a.file && !b.file) {
      return 1
    } else {
      return -1
    }
  },
  mapFn: (node) => {
    if (node.file?.dates?.modified) {
      const date = new Date(node.file.dates.modified)
      const month = date.toLocaleString('en', { month: 'short' })
      const year = date.getFullYear().toString().slice(2)
      node.displayName = `${node.displayName} (${month}'${year})`
    }
    return node
  },
});
// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.TagList(),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Search(),
    Component.Darkmode(),
    Component.DesktopOnly(Explorer),
  ],
  right: [
    // Component.Graph(),
    Component.DesktopOnly(Component.TableOfContents()),
    // Component.Backlinks(),
    Component.MobileOnly(Explorer)
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Search(),
    Component.Darkmode(),
    Component.DesktopOnly(Component.Explorer()),
  ],
  right: [],
}
