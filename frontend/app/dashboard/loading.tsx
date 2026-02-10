export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-48 bg-gray-700/50 rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 bg-gray-700/50 rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-64 bg-gray-700/50 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
