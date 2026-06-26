import { Button, Card, CardBody } from "@heroui/react";
import { ArrowLeft, Construction } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { StatusPill } from "@/components/StatusPill";

interface PlaceholderPageProps {
  title: string;
  description: string;
  status: string;
}

export function PlaceholderPage({ title, description, status }: PlaceholderPageProps) {
  const navigate = useNavigate();

  return (
    <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
      <Card className="w-full max-w-3xl rounded-lg border border-slate-200 shadow-none">
        <CardBody className="gap-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-lg bg-action-soft text-action">
              <Construction className="h-6 w-6" aria-hidden="true" />
            </span>
            <StatusPill tone="warning">{status}</StatusPill>
          </div>
          <div>
            <h1 className="text-2xl font-black text-ink">{title}</h1>
            <p className="mt-3 text-base font-medium leading-7 text-slate-600">
              {description}
            </p>
          </div>
          <Button
            className="w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            variant="flat"
            onPress={() => navigate("/")}
          >
            返回工作台
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
