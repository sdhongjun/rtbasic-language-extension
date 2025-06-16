' 测试多变量定义格式化
Dim a, b, c As Integer
Global Dim x(10), y(20) As String
Dim p As Integer, q As String, r As Double
Local m,n(5) As Integer, k As String ' 带注释的行
Dim i,j 'without type
Global Dim arr1(10), arr2(20)
Dim str1, str2, str3 As String ' 多个变量共享类型
Dim num1 As Integer, str4 As String, flag As Boolean ' 不同类型
Global Dim count, total As Integer, name As String ' Global with mixed types