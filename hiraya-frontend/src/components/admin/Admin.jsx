import { useState, useMemo } from 'react';
import AdminLayout from './AdminLayout';
import DashboardTab from './tabs/dashboard/DashboardTab';
import InventoryTab from './tabs/inventory/InventoryTab';
import OrdersTab from './tabs/orders/OrdersTab';
import CanvassLookupTab from './tabs/canvass-lookup/CanvassLookupTab';
import AlertsTab from './tabs/alerts/AlertsTab';

const Admin = ({
  products = [],
  editingId,
  formData,
  setFormData,
  imageFile,
  previewUrl,
  loading,
  fetching,
  defaultImageUrl,
  onFileChange,
  onSubmit,
  onReset,
  onEditClick,
  onDelete,
  onBulkUpdate,
  onRefresh,
  ordersBadge = 0,
}) => {
  const [activeTab, setActiveTab] = useState('dashboard');

  // Count of products below the healthy threshold (< 5 total stock) — drives the
  // badge on the navbar Stock Alerts icon.
  const stockAlertsCount = useMemo(
    () => products.filter((p) => Number(p.stock || 0) < 5).length,
    [products]
  );

  return (
    <AdminLayout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      ordersBadge={ordersBadge}
      stockAlertsCount={stockAlertsCount}
    >
      {activeTab === 'dashboard' && (
        <DashboardTab
          products={products}
          onNavigateToInventory={() => setActiveTab('inventory')}
        />
      )}

      {activeTab === 'orders' && <OrdersTab />}

      {activeTab === 'canvass-lookup' && <CanvassLookupTab />}

      {activeTab === 'alerts' && (
        <AlertsTab products={products} defaultImageUrl={defaultImageUrl} />
      )}

      {activeTab === 'inventory' && (
        <InventoryTab
          products={products}
          editingId={editingId}
          formData={formData}
          setFormData={setFormData}
          imageFile={imageFile}
          previewUrl={previewUrl}
          loading={loading}
          fetching={fetching}
          defaultImageUrl={defaultImageUrl}
          onFileChange={onFileChange}
          onSubmit={onSubmit}
          onReset={onReset}
          onEditClick={onEditClick}
          onDelete={onDelete}
          onBulkUpdate={onBulkUpdate}
        />
      )}
    </AdminLayout>
  );
};

export default Admin;