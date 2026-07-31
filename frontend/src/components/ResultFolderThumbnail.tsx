interface ResultFolderThumbnailProps {
  firstPhotoUrl: string | null;
  title: string;
}

export function ResultFolderThumbnail({ firstPhotoUrl, title }: ResultFolderThumbnailProps) {
  return (
    <span className="result-folder-thumbnail">
      <img alt="" aria-hidden="true" className="result-folder-thumbnail-background" src="/images/result-folder.png" />
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
