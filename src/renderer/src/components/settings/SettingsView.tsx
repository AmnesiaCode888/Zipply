import React from 'react'
import { SettingsTab } from '../../types/settings'
import { ModelsSettings } from './ModelsSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { ShortcutsSettings } from './ShortcutsSettings'
import { StorageSettings } from './StorageSettings'
import { McpView } from '../mcp/McpView'
import { ComingSoonSettings } from './ComingSoonSettings'
import './SettingsView.css'

interface SettingsViewProps {
  activeTab: SettingsTab
  onSelectTab?: (tab: SettingsTab) => void
  onCloseSettings?: () => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({ activeTab }) => {
  return (
    <div className="settings-view-wrapper custom-scrollbar">
      <div className="settings-content-body">
        {activeTab === 'models' && <ModelsSettings />}
        {activeTab === 'mcp' && <McpView />}
        {activeTab === 'appearance' && <AppearanceSettings />}
        {activeTab === 'shortcuts' && <ShortcutsSettings />}
        {activeTab === 'storage' && <StorageSettings />}
        {activeTab !== 'models' &&
          activeTab !== 'mcp' &&
          activeTab !== 'appearance' &&
          activeTab !== 'shortcuts' &&
          activeTab !== 'storage' && <ComingSoonSettings />}
      </div>
    </div>
  )
}

export default SettingsView


