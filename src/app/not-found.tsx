import Link from 'next/link';
import { Button } from 'antd';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#FAF8F5] text-center">
      <h2 className="text-2xl font-bold text-[#141414] mb-2">Page Not Found</h2>
      <p className="text-xs text-gray-500 mb-4">
        The requested decision workbench record or module could not be found.
      </p>
      <Link href="/command">
        <Button type="primary" className="bg-[#141414]">Return to Command Center</Button>
      </Link>
    </div>
  );
}
