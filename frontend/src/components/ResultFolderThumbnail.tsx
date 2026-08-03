interface ResultFolderThumbnailProps {
  firstPhotoUrl: string | null;
  folderImageSrc?: string;
  title: string;
}

export function ResultFolderThumbnail({
  firstPhotoUrl,
  folderImageSrc = "/images/result-folder.png",
  title
}: ResultFolderThumbnailProps) {
  return (
    <span className="result-folder-thumbnail">
      <img alt="" aria-hidden="true" className="result-folder-thumbnail-background" src={folderImageSrc} />
      {firstPhotoUrl ? (
        <img
          alt={`${title}的第一张照片`}
          className="result-folder-thumbnail-photo"
          decoding="async"
          loading="lazy"
          src={firstPhotoUrl}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </span>
  );
}
