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
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: `${sidebarCol} 1fr ${inspectorCol}`,
        transition: 'grid-template-columns 0.25s ease',
        overflow: 'hidden',
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          overflow: 'hidden',
          width: showSidebar ? SIDEBAR_WIDTH : 0,
          minWidth: 0,
          transition: 'width 0.25s ease',
          borderRight: showSidebar ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
          background: 'rgba(30, 30, 46, 0.95)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {sidebar}
      </div>

      {/* Center — always fills remaining space */}
      <div style={{ overflow: 'hidden', position: 'relative', minWidth: 0 }}>
        {center}
      </div>

      {/* Inspector */}
      <div
        style={{
          overflow: 'hidden',
          width: showInspector ? INSPECTOR_WIDTH : 0,
          minWidth: 0,
          transition: 'width 0.25s ease',
          borderLeft: showInspector ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
          background: 'rgba(30, 30, 46, 0.95)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {inspector}
      </div>
    </div>
  )
}
