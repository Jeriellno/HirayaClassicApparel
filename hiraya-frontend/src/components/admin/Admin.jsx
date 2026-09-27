import { useState, useMemo } from 'react';
import AdminLayout from './AdminLayout';
import DashboardTab from './tabs/dashboard/DashboardTab';
import InventoryTab from './tabs/inventory/InventoryTab';
import OrdersTab from './tabs/orders/OrdersTab';
import CanvassLookupTab from './tabs/canvass-lookup/CanvassLookupTab';
import AlertsTab from './tabs/alerts/AlertsTab';
import { countLowStockVariants } from './tabs/alerts/stockAlerts';

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
  const [stockAlertThreshold, setStockAlertThreshold] = useState(5);
  const [productToOpen, setProductToOpen] = useState(null);

  // Count of size variants at or below the configured alert threshold.
  const stockAlertsCount = useMemo(
    () => countLowStockVariants(products, stockAlertThreshold),
    [products, stockAlertThreshold]
  );

  const openProductInInventory = (product) => {
    setProductToOpen(product);
    setActiveTab('inventory');
  };

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
        <AlertsTab
          products={products}
          defaultImageUrl={defaultImageUrl}
          threshold={stockAlertThreshold}
          onThresholdChange={setStockAlertThreshold}
          onOpenProduct={openProductInInventory}
        />
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
          productToOpen={productToOpen}
          onProductOpened={() => setProductToOpen(null)}
        />
      )}
    </AdminLayout>
  );
};

export default Admin;