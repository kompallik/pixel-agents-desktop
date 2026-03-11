import type { ReactNode } from 'react'

interface DashboardLayoutProps {
  sidebar: ReactNode
  center: ReactNode
  inspector: ReactNode
  showSidebar: boolean
  showInspector: boolean
}

const SIDEBAR_WIDTH = 280
const INSPECTOR_WIDTH = 320

export function DashboardLayout({ sidebar, center, inspector, showSidebar, showInspector }: DashboardLayoutProps) {
  const sidebarCol = showSidebar ? `${SIDEBAR_WIDTH}px` : '0px'
  const inspectorCol = showInspector ? `${INSPECTOR_WIDTH}px` : '0px'

  return (
    <div
      className="dashboard-layout"
      style={{ gridTemplateColumns: `${sidebarCol} 1fr ${inspectorCol}` }}
    >
      <div
        className={`dashboard-sidebar${showSidebar ? '' : ' collapsed'}`}
        style={{ width: showSidebar ? SIDEBAR_WIDTH : 0 }}
      >
        {sidebar}
      </div>

      <div className="dashboard-center">
        {center}
      </div>

      <div
        className={`dashboard-inspector${showInspector ? '' : ' collapsed'}`}
        style={{ width: showInspector ? INSPECTOR_WIDTH : 0 }}
      >
        {inspector}
      </div>
    </div>
  )
}
