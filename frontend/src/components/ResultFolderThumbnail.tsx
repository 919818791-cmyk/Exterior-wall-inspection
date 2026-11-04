import { Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

interface ResultFolderThumbnailProps {
  firstPhotoUrl: string | null;
  title: string;
}

export function ResultFolderThumbnail({
  firstPhotoUrl,
  title
}: ResultFolderThumbnailProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [firstPhotoUrl]);

  const showPhoto = Boolean(firstPhotoUrl) && !imageFailed;

  return (
    <span className="result-folder-thumbnail">
      {showPhoto ? (
        <img
          alt={`${title}的第一张照片`}
          className="result-folder-thumbnail-photo"
          decoding="async"
          loading="lazy"
          src={firstPhotoUrl ?? undefined}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="result-folder-thumbnail-placeholder" role="img" aria-label={`${title}暂无可用缩略图`}>
          <ImageIcon aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
