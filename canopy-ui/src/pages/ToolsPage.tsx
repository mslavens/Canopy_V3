import React from 'react';
import { EmptyState } from '../components/EmptyState';
import { CIDRCalculator } from './tools/CIDRCalculator';
import { ResolverSandbox } from './tools/ResolverSandbox';
import { Wrench } from 'lucide-react';


interface ToolsPageProps {
  auth: any;
  activeSubTab: string;
}

export const ToolsPage: React.FC<ToolsPageProps> = ({ auth, activeSubTab }) => {
  if (activeSubTab === 'CIDR Subnet Calculator') {
    return <CIDRCalculator />;
  }

  if (activeSubTab === 'Resolver Sandbox') {
    return <ResolverSandbox apiClient={auth?.apiClient} />;
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <EmptyState
        icon={<Wrench size={40} />}
        title="Tool Not Found"
        description={`The tool "${activeSubTab}" is currently under construction or does not exist.`}
      />
    </div>
  );
};
