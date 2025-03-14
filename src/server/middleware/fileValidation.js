export function validateFile(req, file, cb) {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ];
  
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'));
  }
  
  // Check file extension
  const allowedExtensions = ['.xlsx', '.xls', '.csv'];
  const fileExtension = '.' + file.originalname.split('.').pop().toLowerCase();
  
  if (!allowedExtensions.includes(fileExtension)) {
    return cb(new Error('Invalid file extension. Only .xlsx, .xls, and .csv files are allowed'));
  }
  
  cb(null, true);
} 