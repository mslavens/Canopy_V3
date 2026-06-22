import React, { useState } from 'react';
import { Activity, Wand2, RefreshCw, CheckCircle, Shield, Layers, Box, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';

interface DatabaseHealthPageProps {
    auth: { url: string; token: string } | null;
    addToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const DatabaseHealthPage: React.FC<DatabaseHealthPageProps> = ({ auth, addToast }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [hasScanned, setHasScanned] = useState(false);
    const [stats, setStats] = useState({
        addressesHealed: 0,
        servicesHealed: 0,
        applicationsHealed: 0,
    });

    const handleRunHealthCheck = async () => {
        setIsScanning(true);
        setHasScanned(false);
        try {
            if (!auth) throw new Error('Not authenticated');
            const apiClient = new CanopyApiClient(auth);
            const data = await apiClient.healWorkspace();
            setStats({
                addressesHealed: data.addresses_healed || 0,
                servicesHealed: data.services_healed || 0,
                applicationsHealed: data.applications_healed || 0,
            });
            setHasScanned(true);
            if (addToast) addToast('Database Healing complete!', 'success');
        } catch (error) {
            console.error(error);
            if (addToast) addToast('An error occurred during healing.', 'error');
        } finally {
            setIsScanning(false);
        }
    };

    const totalHealed = stats.addressesHealed + stats.servicesHealed + stats.applicationsHealed;

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-200">
            <PageHeader 
                title="Database Health" 
                description="Scan and heal your workspace database automatically." 
                isSticky={false}
                actions={
                    <button 
                        onClick={handleRunHealthCheck}
                        disabled={isScanning}
                        className="w-56 justify-center bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-lg shadow-purple-900/20 flex items-center gap-2"
                    >
                        {isScanning ? <RefreshCw size={16} className="animate-spin shrink-0" /> : <Wand2 size={16} className="shrink-0" />} 
                        <span className="truncate">{isScanning ? 'Scanning...' : 'Run Health Check & Heal'}</span>
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 pt-6 bg-slate-900">
                <div className="max-w-5xl mx-auto mb-8 bg-slate-800/80 border border-slate-700 rounded-lg p-5 shadow-sm text-sm text-slate-300 leading-relaxed">
                    <div className="flex items-center gap-2 font-bold text-white mb-3">
                        <Shield size={16} className="text-blue-400" /> Database Reconciliation Details
                    </div>
                    <p className="mb-2">When you import your configurations, Canopy maps policies to their underlying objects. If an object definition isn't found at import time, Canopy safely preserves the name as an <strong>ad-hoc value</strong>.</p>
                    <p>If you subsequently import the actual objects or groups, run this tool! It will execute a rapid database scan to link those ad-hoc values to your newly imported objects natively, perfectly respecting your Device Group hierarchy and Scope rules.</p>
                </div>

                {!hasScanned && !isScanning && (
                    <div className="flex flex-col items-center justify-center text-slate-500 max-w-md mx-auto text-center mt-12">
                        <Wand2 size={48} className="mb-4 opacity-20 text-purple-400" />
                        <h3 className="text-lg font-medium text-slate-300 mb-2">Ready to Scan</h3>
                        <p className="text-sm leading-relaxed">Click the <strong>Run Health Check & Heal</strong> button above to inspect and reconcile your workspace.</p>
                    </div>
                )}

                {isScanning && (
                    <div className="flex flex-col items-center justify-center text-slate-500 mt-12">
                        <RefreshCw size={32} className="animate-spin text-purple-500 mb-4" />
                        <p className="font-bold text-slate-300 mb-2">Executing highly optimized recursive CTE sweeps across your workspace mappings...</p>
                    </div>
                )}

                {hasScanned && totalHealed === 0 && (
                    <div className="flex flex-col items-center justify-center text-emerald-500 max-w-md mx-auto text-center mt-12">
                        <CheckCircle size={48} className="mb-4 opacity-80" />
                        <h3 className="text-lg font-bold text-emerald-400 mb-2">Database is perfectly healthy!</h3>
                        <p className="text-sm text-slate-400 leading-relaxed">
                            No orphaned references were found that matched any known objects in your scope hierarchy.
                        </p>
                    </div>
                )}

                {hasScanned && totalHealed > 0 && (
                    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col items-center justify-center shadow-inner">
                                <span className="text-3xl font-black text-purple-400 font-mono mb-1">{stats.addressesHealed}</span>
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Box size={14}/> Addresses Healed</span>
                            </div>
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col items-center justify-center shadow-inner">
                                <span className="text-3xl font-black text-blue-400 font-mono mb-1">{stats.servicesHealed}</span>
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Layers size={14}/> Services Healed</span>
                            </div>
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col items-center justify-center shadow-inner">
                                <span className="text-3xl font-black text-emerald-400 font-mono mb-1">{stats.applicationsHealed}</span>
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><AlertTriangle size={14}/> Apps Healed</span>
                            </div>
                        </div>
                        <div className="bg-slate-800/80 border border-emerald-900/50 rounded-lg p-5 shadow-sm text-center">
                            <h3 className="text-lg font-bold text-emerald-400 mb-2">Healing Successful</h3>
                            <p className="text-sm text-slate-300">Successfully linked {totalHealed} orphaned dependencies natively across your workspace!</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
